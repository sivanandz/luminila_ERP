"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import { Header } from "@/components/layout";
import {
    whatsappManager,
    checkWPPConnectStatus,
    parseOrderFromMessage,
    normalizeMessageId,
    getMessageStanzaId,
} from "@/lib/whatsapp";
import type { WPPMessage } from "@/lib/whatsapp";
import { toast } from "sonner";
import { pb } from "@/lib/pocketbase";
import { findMatchingProducts, generateImageHash } from "@/lib/image-matcher";
import {
    MessageCircle,


    Send,
    User,

    Package,
    AlertCircle,


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
    Store,
    RadioTower,
    Users,
    Radio,
    Share2,
    ShieldCheck,
    ShieldAlert,
    Flame,
    ChevronLeft,
    PanelRightClose,
    PanelRightOpen,
    Building2,
    Megaphone,
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
import { ChatContextMenu } from "@/components/whatsapp/ChatContextMenu";
import { SlashCommandPalette } from "@/components/whatsapp/SlashCommandPalette";
import { RazorpayPaymentModal } from "@/components/whatsapp/RazorpayPaymentModal";
import { WhatsAppCatalogSyncModal } from "@/components/whatsapp/WhatsAppCatalogSyncModal";
import { WhatsAppCatalogEditorModal } from "@/components/whatsapp/WhatsAppCatalogEditorModal";
import { ProductBroadcastModal } from "@/components/whatsapp/ProductBroadcastModal";
import { FlashDropModal } from "@/components/whatsapp/FlashDropModal";
import { updateCustomerCRMProfile, setCustomerLeadStatus } from "@/lib/customer-lookup";
import { sendPaidOrderInvoice } from "@/lib/whatsapp-notifications";
import { ingestWhatsAppCatalogOrder } from "@/lib/whatsapp-order-ingestion";
import { useLongPress } from "@/hooks/use-long-press";
import { MessageActionMenu } from "@/components/whatsapp/MessageActionMenu";
import { VendorIngestionModal, AddExistingInventoryModal } from "@/components/whatsapp/VendorIngestionModal";
import {
    resolveContact,
    ensureChat,
    persistMessages,
    markChatRead,
    broadcastAddToPOS,
    extractVariantHints,
    queueLabelPrint,
    getStoredChats,
    setChatContactType,
    setChatVendorGroup,
    detectIntent,
    sendProductCard,
    setWhatsAppOptOut,
    type ContactType,
} from "@/lib/whatsapp-crm";
import { startPaymentReconciler } from "@/lib/payment-reconciliation";
import { processBroadcastQueue } from "@/lib/whatsapp-broadcast";
import { BroadcastComposerModal } from "@/components/whatsapp/BroadcastComposerModal";
import { AdminApprovalModal } from "@/components/whatsapp/AdminApprovalModal";
import { MarqueeText } from "@/components/ui/marquee-text";
import { getWhatsAppBinding, type WhatsAppBinding } from "@/lib/whatsapp-binding";
import { getTenantWhatsAppSessionId } from "@/lib/whatsapp";
import { useAuth } from "@/contexts/AuthContext";
import type { Product as ProductRecord, Sale } from "@/types/database";
import { getChannelPrice } from "@/lib/channel-pricing";

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
        thumbnail?: string;
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
    isCommunity?: boolean;
    isCommunityAnnounce?: boolean;
    isNewsletter?: boolean;
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

// Lead pipeline stage reused from the Customer record type (null removed for form/handler use).
type CustomerLeadStatus = NonNullable<Customer["lead_status"]>;

// WPPMessage records hydrated from the local transcript also carry a resolved sender display name.
interface WPPMessageWithFromName extends WPPMessage {
    fromName?: string;
}

// Local transcript Message viewed through the WPPMessage-typed context-menu contract.
type ChatMenuMessage = Message & WPPMessage;

// --- Components ---

function ChatAvatar({
    profilePic,
    name,
    isChan,
    isVendorGrp,
    isCommAnnounce,
    isGrp,
    size = 40,
}: {
    profilePic?: string | null;
    name?: string;
    isChan?: boolean;
    isVendorGrp?: boolean;
    isCommAnnounce?: boolean;
    isGrp?: boolean;
    size?: number;
}) {
    const [imgFailed, setImgFailed] = useState(false);

    useEffect(() => {
        setImgFailed(false);
    }, [profilePic]);

    const hasPic = Boolean(profilePic && !imgFailed);
    const iconSize = size <= 32 ? 15 : size >= 56 ? 26 : 18;

    return (
        <div
            style={{ width: size, height: size }}
            className={`rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden ${
                isChan
                    ? 'bg-violet-500/15'
                    : isVendorGrp
                    ? 'bg-indigo-500/15'
                    : isCommAnnounce
                    ? 'bg-amber-500/15'
                    : isGrp
                    ? 'bg-sky-500/15'
                    : 'bg-muted'
            }`}
        >
            {hasPic ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={profilePic!}
                    alt={name || "Avatar"}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                    onError={() => setImgFailed(true)}
                />
            ) : isChan ? (
                <Radio size={iconSize} className="text-violet-400" />
            ) : isVendorGrp ? (
                <Building2 size={iconSize} className="text-indigo-400" />
            ) : isCommAnnounce ? (
                <Megaphone size={iconSize} className="text-amber-400" />
            ) : isGrp ? (
                <Users size={iconSize} className="text-sky-400" />
            ) : (
                <User size={iconSize} className="text-muted-foreground" />
            )}
        </div>
    );
}

function QuotedBlock({
    msg,
    chatMessages,
    onLoadMedia,
}: {
    msg: Message;
    chatMessages?: Message[];
    onLoadMedia?: (messageId: string) => Promise<string | null>;
}) {
    if (!msg.quotedMsg) return null;

    const isMediaQuote = ['image', 'sticker', 'video', 'ptt', 'audio', 'document'].includes(msg.quotedMsg.type);
    const hasImageThumbnail = ['image', 'sticker', 'video'].includes(msg.quotedMsg.type);

    // Initial thumbnail check:
    // 1. QuotedMsg mediaUrl or thumbnail if data URL or valid non-whatsapp http URL
    // 2. ChatMessages lookup if parent message is in memory
    const getInitialThumbnail = (): string | null => {
        const q = msg.quotedMsg;
        if (!q) return null;
        if (q.thumbnail && q.thumbnail.startsWith('data:')) return q.thumbnail;
        if (q.mediaUrl && (q.mediaUrl.startsWith('data:') || (q.mediaUrl.startsWith('http') && !q.mediaUrl.includes('whatsapp.net')))) {
            return q.mediaUrl;
        }
        if (chatMessages && q.id) {
            const stanza = getMessageStanzaId(q.id);
            const found = chatMessages.find(m => m.id === q.id || (stanza && getMessageStanzaId(m.id) === stanza));
            if (found?.mediaUrl && (found.mediaUrl.startsWith('data:') || (found.mediaUrl.startsWith('http') && !found.mediaUrl.includes('whatsapp.net')))) {
                return found.mediaUrl;
            }
        }
        return null;
    };

    const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(getInitialThumbnail);
    const [loadingThumbnail, setLoadingThumbnail] = useState(false);
    const [imgFailed, setImgFailed] = useState(false);

    useEffect(() => {
        const initial = getInitialThumbnail();
        if (initial) {
            setThumbnailUrl(initial);
            return;
        }
        if (hasImageThumbnail && onLoadMedia && msg.quotedMsg?.id && !thumbnailUrl && !loadingThumbnail && !imgFailed) {
            setLoadingThumbnail(true);
            onLoadMedia(msg.quotedMsg.id)
                .then(url => {
                    if (url) {
                        setThumbnailUrl(url);
                    } else {
                        setImgFailed(true);
                    }
                })
                .catch(() => setImgFailed(true))
                .finally(() => setLoadingThumbnail(false));
        }
    }, [msg.quotedMsg?.id, hasImageThumbnail, onLoadMedia, chatMessages]);

    const handleQuoteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!msg.quotedMsg?.id) return;

        const rawQuotedId = normalizeMessageId(msg.quotedMsg.id);
        const stanzaId = getMessageStanzaId(rawQuotedId);

        // 1. Try exact match by full ID
        let targetElement: HTMLElement | null = null;
        if (rawQuotedId) {
            targetElement = document.getElementById(`msg-${rawQuotedId}`);
            if (!targetElement) {
                try {
                    targetElement = document.querySelector(`[data-msg-id="${CSS.escape(rawQuotedId)}"]`) as HTMLElement;
                } catch { /* ignore query error */ }
            }
        }

        // 2. Try match by stanza ID (unique message hash)
        if (!targetElement && stanzaId) {
            try {
                targetElement = document.querySelector(`[data-stanza-id="${CSS.escape(stanzaId)}"]`) as HTMLElement;
            } catch { /* ignore */ }

            if (!targetElement) {
                try {
                    targetElement = document.querySelector(`[data-msg-id$="${CSS.escape(stanzaId)}"]`) as HTMLElement;
                } catch { /* ignore */ }
            }

            if (!targetElement) {
                try {
                    targetElement = document.querySelector(`[data-msg-id*="${CSS.escape(stanzaId)}"]`) as HTMLElement;
                } catch { /* ignore */ }
            }
        }

        // 3. Fallback: match via chatMessages in state
        if (!targetElement && chatMessages && (rawQuotedId || stanzaId)) {
            const match = chatMessages.find(m =>
                m.id === rawQuotedId ||
                (stanzaId && getMessageStanzaId(m.id) === stanzaId) ||
                (stanzaId && m.id.includes(stanzaId))
            );
            if (match) {
                targetElement = document.getElementById(`msg-${match.id}`) ||
                    document.querySelector(`[data-msg-id="${CSS.escape(match.id)}"]`) as HTMLElement;
            }
        }

        if (targetElement) {
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetElement.classList.add('ring-2', 'ring-primary', 'bg-primary/10', 'rounded-xl', 'transition-all', 'duration-500');
            setTimeout(() => {
                targetElement?.classList.remove('ring-2', 'ring-primary', 'bg-primary/10');
            }, 2500);
        } else {
            toast.info("Original quoted message is older or not loaded in recent history");
        }
    };

    return (
        <div
            onClick={handleQuoteClick}
            className={`mb-2 border-l-2 pl-2 py-1 text-xs rounded cursor-pointer hover:opacity-85 transition-opacity flex items-center gap-2 select-none ${msg.fromMe ? 'border-primary-foreground/50 bg-primary/20' : 'border-primary/50 bg-muted/60'}`}
            title="Click to view quoted message"
        >
            {hasImageThumbnail && (
                <div className="w-10 h-10 flex-shrink-0 rounded overflow-hidden bg-muted flex items-center justify-center relative border border-border/30">
                    {thumbnailUrl && !imgFailed ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={thumbnailUrl}
                            alt="Quoted media thumbnail"
                            className="w-full h-full object-cover"
                            onError={() => setImgFailed(true)}
                        />
                    ) : loadingThumbnail ? (
                        <Loader2 size={14} className="animate-spin text-muted-foreground" />
                    ) : (
                        <ImageIcon size={16} className="text-muted-foreground/70" />
                    )}
                </div>
            )}

            <div className="flex-1 min-w-0">
                {msg.quotedMsg.sender && (
                    <p className="font-semibold opacity-90 truncate">{msg.quotedMsg.sender}</p>
                )}
                <p className="opacity-75 line-clamp-2">
                    {isMediaQuote && msg.quotedMsg.type !== 'image' && msg.quotedMsg.type !== 'sticker' && msg.quotedMsg.type !== 'video'
                        ? `📎 ${msg.quotedMsg.type === 'ptt' ? 'Voice message' : msg.quotedMsg.type === 'document' ? 'Document' : msg.quotedMsg.type}`
                        : isMediaQuote && msg.quotedMsg.type === 'image'
                            ? (msg.quotedMsg.caption || '📷 Photo')
                            : isMediaQuote && msg.quotedMsg.type === 'sticker'
                                ? 'Sticker'
                                : isMediaQuote && msg.quotedMsg.type === 'video'
                                    ? (msg.quotedMsg.caption || '🎬 Video')
                                    : (msg.quotedMsg.body || msg.quotedMsg.caption || '')
                    }
                </p>
            </div>
        </div>
    );
}

function MessageContent({ msg, onLoadMedia, onFindSimilar, chatMessages }: {
    msg: Message;
    onLoadMedia?: (messageId: string) => Promise<string | null>;
    onFindSimilar?: (imageUrl: string) => void;
    chatMessages?: Message[];
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

        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional run-once latch: synchronously moving `status` off `idle` stops this effect from re-firing on its own dependency update
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
                <QuotedBlock msg={msg} chatMessages={chatMessages} onLoadMedia={onLoadMedia} />
                {status === 'loading' && (
                    <div className="flex items-center gap-2 text-muted-foreground p-3">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-sm">Loading image...</span>
                    </div>
                )}
                {status === 'loaded' && mediaUrl && (
                    <div className="relative group">
                        {/* eslint-disable-next-line @next/next/no-img-element -- WhatsApp media has inherently dynamic dimensions, so natural aspect-ratio rendering of a plain img is required */}
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
                        {/* eslint-disable-next-line @next/next/no-img-element -- lightbox shows full-size media of arbitrary dimensions, which a plain img renders at natural aspect ratio */}
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
                <QuotedBlock msg={msg} chatMessages={chatMessages} onLoadMedia={onLoadMedia} />
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
                <QuotedBlock msg={msg} chatMessages={chatMessages} onLoadMedia={onLoadMedia} />
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
                <QuotedBlock msg={msg} chatMessages={chatMessages} onLoadMedia={onLoadMedia} />
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

    if (hasLinks) {
        const parts = msg.body.split(urlRegex);
        return (
            <div>
                <QuotedBlock msg={msg} chatMessages={chatMessages} onLoadMedia={onLoadMedia} />
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
            <QuotedBlock msg={msg} chatMessages={chatMessages} onLoadMedia={onLoadMedia} />
            <p className="text-sm leading-relaxed">{msg.body}</p>
        </div>
    );
}

// --- Main Page ---

export default function WhatsAppPage() {
    const { user } = useAuth();
    const tenantSessionId = React.useMemo(
        () => getTenantWhatsAppSessionId(user?.id || user?.email),
        [user?.id, user?.email]
    );

    React.useEffect(() => {
        whatsappManager.setSessionId(tenantSessionId);
    }, [tenantSessionId]);

    // WhatsApp State
    const [serverStatus, setServerStatus] = useState<"checking" | "online" | "offline">("checking");
    const [sessionStatus, setSessionStatus] = useState<"disconnected" | "connecting" | "qr" | "connected">("disconnected");
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [pairingCode, setPairingCode] = useState<string | null>(null);
    const [loginMethod, setLoginMethod] = useState<'qr' | 'phone'>('qr');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [connectedDeviceNumber, setConnectedDeviceNumber] = useState<string | null>(null);
    const [pairingLoading, setPairingLoading] = useState(false);
    const phonePollRef = React.useRef<NodeJS.Timeout | null>(null);

    const [chats, setChats] = useState<ChatListItem[]>([]);
    const [loadingChats, setLoadingChats] = useState(false);
    const [selectedChat, setSelectedChat] = useState<string | null>(null);
    const selectedChatRef = React.useRef<string | null>(null);
    const readChatTimestampsRef = React.useRef<Map<string, number>>(new Map());

    // Hydrate read timestamps from sessionStorage on initial mount
    useEffect(() => {
        try {
            const raw = sessionStorage.getItem('wa_read_timestamps');
            if (raw) {
                const parsed = JSON.parse(raw);
                readChatTimestampsRef.current = new Map(Object.entries(parsed));
            }
        } catch { /* ignore storage error */ }
    }, []);

    const markChatAsReadLocally = useCallback((chatId: string) => {
        const now = Math.floor(Date.now() / 1000);
        readChatTimestampsRef.current.set(chatId, now);
        try {
            sessionStorage.setItem('wa_read_timestamps', JSON.stringify(Object.fromEntries(readChatTimestampsRef.current)));
        } catch { /* ignore storage error */ }
        setChats(prev => prev.map(c => c.id === chatId ? { ...c, unreadCount: 0 } : c));
        whatsappManager.markAsRead(chatId).catch(() => {});
    }, []);

    useEffect(() => {
        selectedChatRef.current = selectedChat;
        if (selectedChat) {
            markChatAsReadLocally(selectedChat);
        }
    }, [selectedChat, markChatAsReadLocally]);
    const [selectedChatMessages, setSelectedChatMessages] = useState<Message[]>([]);
    const [, setLoadingMessages] = useState(false);
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

    // Context Menu & Enhancements State
    const [contextMenu, setContextMenu] = useState<{
        isOpen: boolean;
        message: WPPMessage | null;
        position: { x: number; y: number } | null;
    }>({ isOpen: false, message: null, position: null });

    // CRM contact binding state (spec §8.1 / §9)
    const [contactType, setContactType] = useState<ContactType>('lead');
    const [contactVendor, setContactVendor] = useState<{ id: string; name: string } | null>(null);
    const [chatTypeMap, setChatTypeMap] = useState<Record<string, ContactType>>({});
    const [chatLabelsMap, setChatLabelsMap] = useState<Record<string, string[]>>({});
    const chatRecordRef = useRef<string | null>(null);
    const connectPollRef = useRef<NodeJS.Timeout | null>(null);
    const autoConnectAttempted = useRef(false);
    const [actionMenu, setActionMenu] = useState<{
        isOpen: boolean;
        message: WPPMessage | null;
        position: { x: number; y: number } | null;
    }>({ isOpen: false, message: null, position: null });
    const [vendorIngestMsg, setVendorIngestMsg] = useState<string | null>(null);
    const [addInventoryMsg, setAddInventoryMsg] = useState<string | null>(null);
    const [vendorIngestImage, setVendorIngestImage] = useState<string | null>(null);
    const [ingestSourceContext, setIngestSourceContext] = useState<{
        chatName?: string;
        senderName?: string;
        isGroup?: boolean;
        isChannel?: boolean;
    } | null>(null);
    const [chatFilter, setChatFilter] = useState<'all' | 'vendor' | 'vendor_group' | 'community' | 'customer' | 'group'>('all');
    // Apple-style Tag layout: 'inline' (beside name with marquee) or 'subtitle' (on message preview line with 100% name width)
    const [badgeLayout, setBadgeLayout] = useState<'inline' | 'subtitle'>('inline');

    useEffect(() => {
        try {
            const savedLayout = localStorage.getItem('wa_badge_layout');
            if (savedLayout === 'inline' || savedLayout === 'subtitle') {
                setBadgeLayout(savedLayout);
            }
        } catch {}
    }, []);

    // WhatsApp Admin Account Binding & Protected Lock State
    const [binding, setBinding] = useState<WhatsAppBinding | null>(null);
    const [approvalModalOpen, setApprovalModalOpen] = useState(false);
    const [approvalModalMode, setApprovalModalMode] = useState<"approval" | "bind" | "details">("approval");
    const [pendingActionType, setPendingActionType] = useState<"unbind" | "reset" | "disconnect">("unbind");

    // Load WhatsApp Admin Binding status on mount and when connection status changes
    useEffect(() => {
        getWhatsAppBinding().then((b) => setBinding(b));
    }, [sessionStatus]);

    // Phase 2/3: payments reconciliation, broadcasts, order-intent banner
    const [showBroadcastModal, setShowBroadcastModal] = useState(false);
    const [showProductBroadcastModal, setShowProductBroadcastModal] = useState(false);
    const [showFlashDropModal, setShowFlashDropModal] = useState(false);
    const [showConciergePanel, setShowConciergePanel] = useState(true);
    const [orderBannerMsg, setOrderBannerMsg] = useState<Message | null>(null);

    // Payment link reconciliation (spec §7) + broadcast queue drain (spec §11)
    useEffect(() => {
        const stopReconciler = startPaymentReconciler(90_000);
        let draining = false;
        const drainTimer = setInterval(async () => {
            if (draining) return;
            draining = true;
            try {
                await processBroadcastQueue();
            } finally {
                draining = false;
            }
        }, 15_000);
        return () => {
            stopReconciler();
            clearInterval(drainTimer);
        };
    }, []);

    // Long-press gesture on the transcript (spec §8.4: 500ms hold, haptic feedback)
    const { pressing: longPressing, handlers: longPressHandlers } = useLongPress((pos) => {
        const el = document.elementFromPoint(pos.x, pos.y)?.closest('[data-msg-id]') as HTMLElement | null;
        const msgId = el?.getAttribute('data-msg-id');
        const msg = selectedChatMessages.find(m => m.id === msgId);
        if (msg) setActionMenu({ isOpen: true, message: msg as unknown as WPPMessage, position: pos });
    });

    // Hydrate previously-resolved contact types and labels for list badges
    useEffect(() => {
        getStoredChats().then((stored) => {
            const map: Record<string, ContactType> = {};
            const labelsMap: Record<string, string[]> = {};
            for (const s of stored) {
                map[s.chat_id] = s.contact_type as ContactType;
                if (s.labels) labelsMap[s.chat_id] = Array.isArray(s.labels) ? s.labels : [];
            }
            setChatTypeMap(map);
            setChatLabelsMap(labelsMap);
        });
    }, []);

    const [showRazorpayModal, setShowRazorpayModal] = useState(false);
    const [razorpayModalAmount, setRazorpayModalAmount] = useState<number>(0);
    const [razorpayModalOrderId, setRazorpayModalOrderId] = useState<string>('');
    const [showCatalogSyncModal, setShowCatalogSyncModal] = useState(false);
    const [showCatalogEditorModal, setShowCatalogEditorModal] = useState(false);
    const [slashPaletteOpen, setSlashPaletteOpen] = useState(false);
    const [slashQuery, setSlashQuery] = useState("");

    // 360 CRM Editing State
    const [editingCRM, setEditingCRM] = useState(false);
    const [crmForm, setCrmForm] = useState({
        ring_size: "",
        bangle_size: "",
        preferred_metal: "Rose Gold",
        anniversary_date: "",
        birthday_date: "",
        lead_status: "new_lead" as CustomerLeadStatus,
    });
    const [savingCRM, setSavingCRM] = useState(false);

    // Initial Load
    const loadExistingChats = useCallback(async () => {
        setLoadingChats(true);
        try {
            const fetchedChats = await whatsappManager.getChats();
            const chatList: ChatListItem[] = await Promise.all(fetchedChats.map(async (chat) => {
                // Use profile pic from chat if already available, otherwise fetch
                let profilePic: string | null = chat.profilePic || null;
                if (!profilePic) {
                    try {
                        profilePic = await whatsappManager.getProfilePic(chat.id);
                    } catch { /* ignore */ }
                }

                const lastReadAt = readChatTimestampsRef.current.get(chat.id);
                const msgTime = chat.lastMessage?.timestamp || chat.timestamp || 0;
                const isChatActive = chat.id === selectedChatRef.current;
                const isReadLocally = lastReadAt !== undefined && msgTime <= lastReadAt;
                const unreadCount = (isChatActive || isReadLocally) ? 0 : chat.unreadCount;

                return {
                    id: chat.id,
                    name: chat.name,
                    lastMessage: chat.lastMessage?.body || "",
                    timestamp: chat.lastMessage?.timestamp || chat.timestamp,
                    unreadCount,
                    isGroup: chat.isGroup,
                    isCommunity: chat.isCommunity,
                    isCommunityAnnounce: chat.isCommunityAnnounce,
                    isNewsletter: chat.isNewsletter,
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
            try {
                const data = await pb.collection('products').getList<ProductRecord>(1, 100);
                setProducts(data.items.map((p) => ({
                    id: p.id,
                    name: p.name,
                    sku: p.sku,
                    base_price: p.base_price,
                    stock: 0,
                    image_url: p.image_url || null
                } as Product)));
            } catch (e) {
                console.error('Failed to fetch products:', e);
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
                const detailed = await whatsappManager.getDetailedStatus().catch(() => null);
                const status = detailed?.status || await whatsappManager.getStatus();
                if (detailed?.connectedNumber) {
                    setConnectedDeviceNumber(detailed.connectedNumber);
                }
                if (status === "CONNECTED") {
                    setSessionStatus("connected");
                    setPairingCode(null);
                    if (phonePollRef.current) {
                        clearInterval(phonePollRef.current);
                        phonePollRef.current = null;
                    }
                    loadExistingChats();
                } else if (status === "QR_CODE") {
                    setSessionStatus("qr");
                    const qr = await whatsappManager.getQR();
                    if (qr) setQrCode(qr);
                } else if (status === "INITIALIZING") {
                    if (!pairingCode) {
                        setSessionStatus((prev) => (prev === "connected" ? "connected" : "connecting"));
                    }
                } else if (status === "DISCONNECTED") {
                    if (!autoConnectAttempted.current) {
                        autoConnectAttempted.current = true;
                        whatsappManager.connect(false).catch(() => {});
                    } else if (!pairingCode) {
                        setSessionStatus((prev) => (prev === "connecting" ? "connecting" : "disconnected"));
                    }
                }
            }
        };
        checkServer();
        const interval = setInterval(checkServer, 10000);
        return () => {
            clearInterval(interval);
            if (phonePollRef.current) {
                clearInterval(phonePollRef.current);
                phonePollRef.current = null;
            }
        };
    }, [loadExistingChats, pairingCode]);

    // Chat Selection
    useEffect(() => {
        const loadChatMessages = async () => {
            if (!selectedChat || sessionStatus !== "connected") {
                setSelectedChatMessages([]);
                setCart([]); // Reset cart on chat switch
                return;
            }
            setLoadingMessages(true);
            markChatAsReadLocally(selectedChat);
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

                // CRM binding + persistence (spec §9 / §12.1)
                const chatMeta = chats.find(c => c.id === selectedChat);
                const ctx = await resolveContact(selectedChat, chatMeta?.name);
                setContactType(ctx.type);
                setContactVendor(ctx.vendor ? { id: ctx.vendor.id, name: ctx.vendor.company_name || ctx.vendor.name } : null);
                setChatTypeMap(prev => ({ ...prev, [selectedChat]: ctx.type }));
                if (ctx.labels && ctx.labels.length > 0) {
                    setChatLabelsMap(prev => ({ ...prev, [selectedChat]: ctx.labels || [] }));
                }

                const stored = await ensureChat({
                    chatId: selectedChat,
                    contactName: chatMeta?.name,
                    contactType: ctx.type,
                    customer: ctx.customer?.id || '',
                    vendor: ctx.vendor?.id || '',
                });
                chatRecordRef.current = stored?.id || null;

                if (stored) {
                    if (stored.labels) {
                        setChatLabelsMap(prev => ({ ...prev, [selectedChat]: Array.isArray(stored.labels) ? stored.labels : [] }));
                    }
                    if (stored.contact_type) {
                        setContactType(stored.contact_type);
                        setChatTypeMap(prev => ({ ...prev, [selectedChat]: stored.contact_type }));
                    }
                    persistMessages(stored.id, msgs);
                    markChatRead(stored.id);
                }

                // Inbound intent router (spec §2): STOP opt-out + order-intent banner
                const lastInbound = [...parsed].reverse().find(m => !m.fromMe && m.body);
                if (lastInbound && detectIntent(lastInbound.body) === 'OPT_OUT') {
                    setWhatsAppOptOut(selectedChat, ctx.customer?.id || undefined).catch(() => {});
                    setAddedToast('Customer opted out — marketing messages blocked');
                    setTimeout(() => setAddedToast(null), 3500);
                }
                const wantsOrder = !!lastInbound && /\b(book|order|buy|purchase|reserve)\b/i.test(lastInbound.body || '');
                setOrderBannerMsg(wantsOrder ? lastInbound : null);
            } catch (err) {
                console.error("Failed to load messages:", err);
            } finally {
                setLoadingMessages(false);
            }
        };
        loadChatMessages();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- chats is only read here for the current chat's display name; adding it would re-download messages, re-persist and re-mark chats read on every 10s poll refresh of the chat list
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
            const chatName = chatInfo?.name || selectedChat.split('@')[0] || 'WhatsApp Customer';
            const newCustomer = await createCustomerFromChat(chatName, selectedChat);
            if (newCustomer) {
                setCustomer(newCustomer);
                setAddedToast("Customer profile created!");
                setTimeout(() => setAddedToast(null), 3000);
            }
        } catch (error) {
            console.error("Error creating customer:", error);
            setAddedToast("Failed to create customer profile");
            setTimeout(() => setAddedToast(null), 3000);
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

            // 1. Create Sale
            const saleData = await pb.collection('sales').create<Sale>({
                customer_name: customerName,
                customer_phone: customerPhone,
                customer: customer?.id || '',
                status: 'pending',
                total: cartTotal,
                subtotal: cartTotal,
                discount: 0,
                channel: 'whatsapp',
                payment_method: 'upi',
            });

            const sale = saleData;

            // 2. Create Sale Items
            if (sale) {
                for (const item of cart) {
                    const variants = await pb.collection('product_variants').getList(1, 1, { filter: `product="${item.id}"` });
                    const variantId = variants.items[0]?.id || '';

                    await pb.collection('sale_items').create({
                        sale: sale.id,
                        product: item.id,
                        variant: variantId,
                        quantity: item.quantity || 1,
                        unit_price: item.base_price,
                        total: item.base_price * (item.quantity || 1),
                        total_price: item.base_price * (item.quantity || 1),
                        discount: 0,
                    });
                }
            }

            // 3. Notify via WhatsApp
            const confirmMsg = `✅ *Order #${sale?.id.slice(0, 8).toUpperCase()} Created*\nTotal: ₹${cartTotal.toLocaleString('en-IN')}\n\nThank you for your order! We are generating your payment link now.`;
            await whatsappManager.sendMessage(selectedChat, confirmMsg);

            // 4. Reset & toast
            setCart([]);
            setAddedToast(`Order #${sale?.id.slice(0, 8).toUpperCase()} created successfully!`);
            setTimeout(() => setAddedToast(null), 3500);

            // 5. Open payment link modal for immediate completion
            setRazorpayModalAmount(cartTotal);
            setRazorpayModalOrderId(sale.id);
            setShowRazorpayModal(true);

        } catch (err) {
            console.error("Order creation failed:", err);
            setAddedToast(`Order failed: ${err instanceof Error ? err.message : String(err)}`);
            setTimeout(() => setAddedToast(null), 3500);
        } finally {
            setOrderLoading(false);
        }
    };


    const handleConnect = async (forceClean = false) => {
        if (connectPollRef.current) clearInterval(connectPollRef.current);
        setSessionStatus("connecting");
        whatsappManager.setSessionId("luminila");
        setQrCode(null);
        setPairingCode(null);
        const started = await whatsappManager.connect(forceClean);
        if (started) {
            connectPollRef.current = setInterval(async () => {
                const status = await whatsappManager.getStatus();
                if (status === "CONNECTED") {
                    setSessionStatus("connected");
                    setQrCode(null);
                    setPairingCode(null);
                    if (connectPollRef.current) clearInterval(connectPollRef.current);
                    loadExistingChats();
                } else if (status === "QR_CODE") {
                    setSessionStatus("qr");
                    const qr = await whatsappManager.getQR();
                    if (qr) {
                        setQrCode(qr);
                    }
                } else if (status === "INITIALIZING") {
                    setSessionStatus("connecting");
                }
            }, 1000);
        } else {
            setSessionStatus("disconnected");
        }
    };

    const executeResetSession = async () => {
        if (connectPollRef.current) clearInterval(connectPollRef.current);
        setSessionStatus("connecting");
        setQrCode(null);
        setPairingCode(null);
        try {
            await whatsappManager.resetSession();
        } catch (e) {
            console.error("Reset error:", e);
        }
        await handleConnect(true);
    };

    const handleResetSession = async () => {
        if (binding?.isBound) {
            setPendingActionType("reset");
            setApprovalModalMode("approval");
            setApprovalModalOpen(true);
            return;
        }
        if (!confirm("Are you sure you want to completely reset and clear stored WhatsApp session credentials? You will be prompted to scan a fresh QR code.")) {
            return;
        }
        await executeResetSession();
    };

    const executeDisconnect = async () => {
        if (connectPollRef.current) clearInterval(connectPollRef.current);
        if (phonePollRef.current) {
            clearInterval(phonePollRef.current);
            phonePollRef.current = null;
        }
        try {
            await whatsappManager.disconnect();
        } catch (e) {
            console.error("Disconnect error:", e);
        }
        setSessionStatus("disconnected");
        setQrCode(null);
        setPairingCode(null);
    };

    const handleDisconnect = async () => {
        if (binding?.isBound) {
            setPendingActionType("disconnect");
            setApprovalModalMode("approval");
            setApprovalModalOpen(true);
            return;
        }
        await executeDisconnect();
    };

    const handleApprovalSuccess = async (_approver: { id: string; email: string; name: string }) => {
        if (pendingActionType === "reset") {
            await executeResetSession();
        } else if (pendingActionType === "disconnect") {
            await executeDisconnect();
        }
    };


    const handleRequestPairingCode = async () => {
        if (!phoneNumber) {
            setPairingCode(null);
            return;
        }
        const cleanPhone = phoneNumber.replace(/\D/g, "");
        setPairingLoading(true);
        setPairingCode(null);
        if (phonePollRef.current) {
            clearInterval(phonePollRef.current);
            phonePollRef.current = null;
        }
        try {
            const response = await whatsappManager.requestPairingCode(cleanPhone);
            if (response && response.code) {
                setPairingCode(response.code);
                phonePollRef.current = setInterval(async () => {
                    const status = await whatsappManager.getStatus();
                    if (status === "CONNECTED") {
                        if (phonePollRef.current) {
                            clearInterval(phonePollRef.current);
                            phonePollRef.current = null;
                        }
                        whatsappManager.setSessionId(tenantSessionId);
                        setSessionStatus("connected");
                        setPairingCode(null);
                        setQrCode(null);
                        loadExistingChats();
                    }
                }, 2000);
            } else {
                setPairingCode(null);
            }
        } catch (e) {
            console.error("Error requesting pairing code:", e instanceof Error ? e.message : String(e));
            setPairingCode(null);
        } finally {
            setPairingLoading(false);
        }
    };

    // Handlers for WhatsApp Context Menu & Enhancements
    const handleSendPaymentLinkToChat = async (url: string, amount: number) => {
        const text = `💳 *Luminila Jewels — Payment Link*

Amount: *₹${amount.toLocaleString('en-IN')}*
Secure checkout via UPI, Credit/Debit Cards, or NetBanking:

🔗 *Pay Now:* ${url}

_Your order will be confirmed and processed immediately upon successful payment._ ✨`;
        if (selectedChat) {
            const success = await whatsappManager.sendMessage(selectedChat, text);
            if (success) {
                setSelectedChatMessages(prev => [...prev, {
                    id: `sent-${Date.now()}`,
                    from: "me",
                    fromName: "You",
                    body: text,
                    timestamp: new Date(),
                    isOrder: false,
                    fromMe: true,
                    type: "chat"
                }]);
            }
        }
    };

    const handleContextAddToCart = (skuOrName: string) => {
        const match = products.find(p =>
            p.sku?.toUpperCase() === skuOrName.toUpperCase() ||
            p.name.toLowerCase().includes(skuOrName.toLowerCase())
        );
        if (match) {
            addToCart(match);
            setAddedToast(`Added ${match.name} to cart!`);
        } else {
            setSearchQuery(skuOrName);
            setActivePanel('concierge');
            setAddedToast(`Searching catalog for "${skuOrName}"`);
        }
        setTimeout(() => setAddedToast(null), 3000);
    };

    const handleContextGeneratePayLink = (detectedAmount?: number) => {
        const cartTotal = cart.reduce((acc, item) => acc + item.base_price * (item.quantity || 1), 0);
        setRazorpayModalAmount(detectedAmount || cartTotal || 0);
        setShowRazorpayModal(true);
    };

    const handleContextConvertToOrder = async (msg: WPPMessage) => {
        if (!selectedChat) return;
        const phone = phoneFromChatId(selectedChat);
        if (!phone) return;

        let items: Array<{
            sku?: string;
            name: string;
            quantity: number;
            unitPrice: number;
            totalPrice: number;
            productId?: string;
        }> = [];

        if (cart.length > 0) {
            items = cart.map(c => ({
                sku: c.sku,
                name: c.name,
                quantity: c.quantity || 1,
                unitPrice: c.base_price,
                totalPrice: c.base_price * (c.quantity || 1),
                productId: c.id
            }));
        } else {
            // Attempt to resolve product from message hints
            const hints = extractVariantHints(msg.body || '');
            const query = hints.sku || hints.productKeywords[0] || '';
            if (query) {
                try {
                    const { getTypeAheadProducts } = await import('@/lib/products');
                    const matches = await getTypeAheadProducts(query);
                    if (matches.length > 0) {
                        const match = matches[0];
                        const price = match.price || match.base_price || 0;
                        items = [{
                            sku: match.full_sku,
                            name: match.name,
                            quantity: 1,
                            unitPrice: price,
                            totalPrice: price,
                            productId: match.id,
                        }];
                    }
                } catch {
                    // ignore lookup errors
                }
            }
        }

        if (items.length === 0) {
            setAddedToast("Please add items to cart or select catalog products before creating an order.");
            setActivePanel('catalog');
            setTimeout(() => setAddedToast(null), 3500);
            return;
        }

        const res = await ingestWhatsAppCatalogOrder(
            msg,
            {
                name: customer?.name || `Customer (${phone.slice(-4)})`,
                phone,
                address: customer?.address || '',
                city: customer?.city || '',
                pincode: customer?.pincode || '',
            },
            items
        );

        if (res.success) {
            setAddedToast(`Draft Order #${res.orderNumber} created!`);
            // Link subsequent Razorpay links from this chat to the draft order so the
            // reconciler settles it automatically (spec §7 / §12.1).
            if (res.orderId) setRazorpayModalOrderId(res.orderId);
            getCustomerOrders(customer?.id || phone).then(setCustomerOrders);
            setActivePanel('orders');
        } else {
            setAddedToast(`Order creation failed: ${res.error}`);
        }
        setTimeout(() => setAddedToast(null), 3500);
    };

    const handleContextSetLeadStatus = async (status: CustomerLeadStatus) => {
        if (!customer) {
            setAddedToast("Please create a customer profile first");
            setTimeout(() => setAddedToast(null), 3000);
            return;
        }
        await setCustomerLeadStatus(customer.id, status);
        setCustomer(prev => prev ? { ...prev, lead_status: status } : null);
        setAddedToast(`Lead status updated: ${status.replace('_', ' ').toUpperCase()}`);
        setTimeout(() => setAddedToast(null), 3000);
    };

    // ===== Context Action Engine additions (spec §8.2 / §8.3) =====

    /** Broadcast a detected product from a chat message straight to the POS terminal cart. */
    const handleBroadcastToPOS = async (msg: WPPMessage) => {
        const hints = extractVariantHints(msg.body || '');
        const query = hints.sku || hints.productKeywords[0] || '';
        if (!query) {
            setAddedToast('No product or SKU detected in this message');
            setTimeout(() => setAddedToast(null), 3000);
            return;
        }
        try {
            const { getTypeAheadProducts } = await import('@/lib/products');
            const matches = await getTypeAheadProducts(query);
            // Optional size refinement (e.g. "size 7")
            let best = matches[0];
            if (hints.size) {
                best = matches.find(m => (m.variant_name || '').includes(hints.size!)) || best;
            }
            if (!best) {
                setAddedToast(`No catalog match for "${query}"`);
                setTimeout(() => setAddedToast(null), 3000);
                return;
            }
            broadcastAddToPOS({
                sku: best.full_sku,
                name: best.name,
                variant: best.variant_name,
                price: getChannelPrice({ base_price: best.base_price, channel_prices: best.channel_prices }, 'whatsapp', best.price_adjustment),
                quantity: 1,
                productId: best.id,
                variantId: best.variant_id,
                sourceChatId: selectedChat || undefined,
                addedByName: chats.find(c => c.id === selectedChat)?.name,
            });
            setAddedToast(`Sent 1x ${best.full_sku} to POS terminal`);
        } catch (err) {
            console.error('Broadcast to POS failed:', err);
            setAddedToast('Failed to send to POS');
        }
        setTimeout(() => setAddedToast(null), 3000);
    };

    /** Queue a Code128 barcode tag for a variant detected from a vendor message. */
    const handleAutoBarcodeTag = async (msg: WPPMessage) => {
        const hints = extractVariantHints(msg.body || '');
        const query = hints.sku || hints.productKeywords[0] || '';
        if (!query) {
            setAddedToast('No SKU detected to tag');
            setTimeout(() => setAddedToast(null), 3000);
            return;
        }
        try {
            const { getTypeAheadProducts } = await import('@/lib/products');
            const matches = await getTypeAheadProducts(query);
            if (!matches[0]) {
                setAddedToast(`No variant found for "${query}"`);
                setTimeout(() => setAddedToast(null), 3000);
                return;
            }
            await queueLabelPrint({
                variantId: matches[0].variant_id,
                quantity: 1,
                template: 'dumbbell',
                source: 'vendor_ingestion',
            });
            setAddedToast(`Barcode tag queued for ${matches[0].full_sku} — print from /labels`);
        } catch (err) {
            console.error('Auto tag queue failed:', err);
            setAddedToast('Failed to queue tag');
        }
        setTimeout(() => setAddedToast(null), 3000);
    };

    /** Real product card dispatch (spec §6.1.2): photo + specs + live stock. */
    const handleSendProductCard = async (msg: WPPMessage) => {
        if (!selectedChat) return;
        const hints = extractVariantHints(msg.body || '');
        const query = hints.sku || hints.productKeywords[0] || '';
        if (!query) {
            setAddedToast('No product detected for the card');
            setTimeout(() => setAddedToast(null), 3000);
            return;
        }
        try {
            const { getTypeAheadProducts } = await import('@/lib/products');
            const matches = await getTypeAheadProducts(query);
            if (!matches[0]) {
                setAddedToast(`No catalog match for "${query}"`);
                setTimeout(() => setAddedToast(null), 3000);
                return;
            }
            const ok = await sendProductCard({
                chatId: selectedChat,
                variantId: matches[0].variant_id,
                chatRecordId: chatRecordRef.current || undefined,
            });
            if (ok) {
                setAddedToast(`Product card sent (${matches[0].full_sku})`);
            } else {
                setAddedToast('Failed to send product card');
            }
        } catch (err) {
            console.error('Product card failed:', err);
            setAddedToast('Failed to send product card');
        }
        setTimeout(() => setAddedToast(null), 3000);
    };

    /** 1-click contact-type toggle in the chat header (spec §8.1). */
    const handleToggleContactType = async () => {
        if (!selectedChat) return;
        const next: ContactType = contactType === 'lead' ? 'customer' : contactType === 'customer' ? 'vendor' : 'lead';
        setContactType(next);
        setChatTypeMap(prev => ({ ...prev, [selectedChat]: next }));

        // Link relations when retagging
        const links: { customer?: string; vendor?: string } = {};
        if (next === 'customer' && customer) links.customer = customer.id;
        if (next === 'vendor') {
            if (contactVendor) links.vendor = contactVendor.id;
            else {
                const ctx = await resolveContact(selectedChat, chats.find(c => c.id === selectedChat)?.name, { autoCreateLead: false });
                if (ctx.vendor) {
                    links.vendor = ctx.vendor.id;
                    setContactVendor({ id: ctx.vendor.id, name: ctx.vendor.company_name || ctx.vendor.name });
                }
            }
        }
        if (chatRecordRef.current) {
            await setChatContactType(chatRecordRef.current, next, links).catch(() => {});
        }
        setAddedToast(`Chat tagged as ${next.toUpperCase()}`);
        setTimeout(() => setAddedToast(null), 2500);
    };

    /** Toggle Vendor Group tag for group chats (spec §8.1/§8.2). */
    const handleToggleVendorGroup = async () => {
        if (!selectedChat) return;
        const isCurrentVendor = chatTypeMap[selectedChat] === 'vendor' || (chatLabelsMap[selectedChat] || []).includes('vendor_group');
        const nextIsVendor = !isCurrentVendor;
        const chatName = chats.find(c => c.id === selectedChat)?.name || 'Vendor Group';

        setChatTypeMap(prev => ({ ...prev, [selectedChat]: nextIsVendor ? 'vendor' : 'lead' }));
        setChatLabelsMap(prev => {
            const cur = prev[selectedChat] || [];
            const next = nextIsVendor
                ? (cur.includes('vendor_group') ? cur : [...cur, 'vendor_group'])
                : cur.filter(l => l !== 'vendor_group');
            return { ...prev, [selectedChat]: next };
        });
        setContactType(nextIsVendor ? 'vendor' : 'lead');

        try {
            await setChatVendorGroup(selectedChat, nextIsVendor, chatName);
            setAddedToast(nextIsVendor ? `Tagged "${chatName}" as Vendor Group` : `Removed Vendor Group tag from "${chatName}"`);
        } catch (err) {
            console.error('Failed to toggle vendor group:', err);
            setAddedToast('Failed to update vendor group status');
        }
        setTimeout(() => setAddedToast(null), 2500);
    };

    const handleSaveCRMProfile = async () => {
        if (!customer) return;
        setSavingCRM(true);
        try {
            const updated = await updateCustomerCRMProfile(customer.id, crmForm);
            if (updated) {
                setCustomer(updated);
                setEditingCRM(false);
                setAddedToast("360° Jewelry Profile Saved!");
            }
        } catch (err) {
            console.error("Failed to save CRM profile:", err);
        } finally {
            setSavingCRM(false);
            setTimeout(() => setAddedToast(null), 3000);
        }
    };

    const handleSelectSlashSnippet = (snippet: string) => {
        setReplyText(snippet);
        setSlashPaletteOpen(false);
    };

    const handleTriggerSlashAction = (actionId: string) => {
        setSlashPaletteOpen(false);
        setReplyText("");
        if (actionId === 'pay') {
            const cartTotal = cart.reduce((acc, item) => acc + item.base_price * (item.quantity || 1), 0);
            setRazorpayModalAmount(cartTotal || 0);
            setShowRazorpayModal(true);
        } else if (actionId === 'product') {
            setActivePanel('concierge');
        } else if (actionId === 'invoice') {
            if (customerOrders.length > 0) {
                sendPaidOrderInvoice(customerOrders[0].id).then(res => {
                    setAddedToast(res.success ? "GST Invoice PDF sent to customer!" : `Invoice error: ${res.error}`);
                    setTimeout(() => setAddedToast(null), 3500);
                });
            } else {
                setAddedToast("No active order found for this customer");
                setTimeout(() => setAddedToast(null), 3000);
            }
        } else if (actionId === 'tracking') {
            setReplyText("🚚 *Tracking Update:* Your Luminila order has been dispatched via BlueDart. Live AWB: BD102938475. Track at https://bluedart.com");
        }
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
                    const existingProducts = await pb.collection('products').getList<ProductRecord>(1, 1, {
                        filter: `image_hash="${imgHash}"`
                    });

                    if (existingProducts.items.length > 0) {
                        const existing = existingProducts.items[0];
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
                                const existingItem = prev.find(i => i.id === matchedProduct.id);
                                if (existingItem) {
                                    return prev.map(i => i.id === matchedProduct.id
                                        ? { ...i, quantity: i.quantity + (addProductForm.initial_stock || 1) }
                                        : i);
                                }
                                return [...prev, { ...matchedProduct, quantity: addProductForm.initial_stock || 1 }];
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
            const productData = await pb.collection('products').create<ProductRecord>({
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
            });

            // If initial stock provided, create a variant with that stock
            if (addProductForm.initial_stock > 0 && productData) {
                await pb.collection('product_variants').create({
                    product: productData.id,
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
            const productsList = await pb.collection('products').getFullList<ProductRecord>({
                filter: 'is_active=true',
                sort: 'name'
            });
            setProducts(productsList.map((p) => ({ id: p.id, sku: p.sku, name: p.name, base_price: p.base_price, image_url: p.image_url || null, stock: 0 })));

        } catch (err) {
            console.error('Failed to add product:', err);
            alert((err instanceof Error ? err.message : String(err)) || 'Failed to add product');
        } finally {
            setAddingProduct(false);
        }
    };

    // Open Add Product Modal from a message image - with duplicate detection


    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="WhatsApp Concierge"
                subtitle="Chat & Create Orders"
                action={
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Quick Broadcast / Drop Campaign Actions */}
                        <button
                            onClick={() => setShowBroadcastModal(true)}
                            className="text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 px-3 py-1.5 rounded-xl flex items-center gap-1.5 font-medium transition-colors border border-amber-500/20 shadow-sm"
                            title="Compose smart broadcast campaign (spec §11 anti-ban queue)"
                            aria-label="Open broadcast campaign composer"
                        >
                            <RadioTower size={14} />
                            <span>Broadcast</span>
                        </button>
                        <button
                            onClick={() => setShowProductBroadcastModal(true)}
                            className="text-xs bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-500 px-3 py-1.5 rounded-xl flex items-center gap-1.5 font-medium transition-colors border border-emerald-500/20 shadow-sm"
                            title="Broadcast inventory products to WhatsApp Status, Channels, Groups & Communities"
                            aria-label="Broadcast Products to WhatsApp"
                        >
                            <Share2 size={14} />
                            <span>Product Drop</span>
                        </button>
                        <button
                            onClick={() => setShowFlashDropModal(true)}
                            className="text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 px-3 py-1.5 rounded-xl flex items-center gap-1.5 font-bold transition-colors border border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.18)]"
                            title="Launch exclusive timed drop to WhatsApp Channels with 10-minute reservation hold"
                            aria-label="Timed Flash Drops"
                        >
                            <Flame size={14} className="text-amber-400" />
                            <span>Flash Drop</span>
                        </button>
                        <button
                            onClick={() => setShowCatalogEditorModal(true)}
                            className="text-xs bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-500 px-3 py-1.5 rounded-xl flex items-center gap-1.5 font-semibold transition-colors border border-emerald-500/20 shadow-sm"
                            title="Open WhatsApp Catalog Editor & Real-Time Inventory Sync"
                            aria-label="Edit WhatsApp Catalog"
                        >
                            <Store size={14} />
                            <span>Catalog Editor</span>
                        </button>

                        {/* Admin Binding Indicator & Fast Lock Status */}
                        {binding?.isBound ? (
                            <button
                                onClick={() => {
                                    setApprovalModalMode("details");
                                    setApprovalModalOpen(true);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/25 hover:bg-emerald-500/20 transition-all shadow-sm"
                                title={`Locked to Admin: ${binding.boundAdminEmail}. Click to manage or unbind.`}
                            >
                                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                                <span className="hidden sm:inline">Admin Bound:</span>
                                <span className="max-w-[130px] truncate">{binding.boundAdminName || binding.boundAdminEmail}</span>
                            </button>
                        ) : (
                            <button
                                onClick={() => {
                                    setApprovalModalMode("bind");
                                    setApprovalModalOpen(true);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-amber-500/10 text-amber-500 border border-amber-500/25 hover:bg-amber-500/20 transition-all shadow-sm"
                                title="Unbound instance. Click to bind to an Admin account to secure connection."
                            >
                                <ShieldAlert className="w-4 h-4 text-amber-500" />
                                <span className="hidden sm:inline">Bind to Admin</span>
                            </button>
                        )}
                    </div>
                }
            />

            <div className="flex-1 overflow-hidden p-6 pb-2">
                {/* Server Status */}
                {serverStatus === "offline" && (
                    <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-lg flex items-center gap-2">
                        <AlertCircle className="text-destructive" size={18} />
                        <span className="text-sm font-bold text-destructive">WPPConnect Server Offline</span>
                    </div>
                )}

                {/* Inbound Order-Intent Approval Banner (spec §2) */}
                {orderBannerMsg && selectedChat && (
                    <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex flex-wrap items-center gap-3">
                        <Sparkles size={16} className="text-amber-500 shrink-0" />
                        <span className="text-xs font-semibold text-foreground flex-1 min-w-40">
                            Order intent detected from {chats.find(c => c.id === selectedChat)?.name || 'customer'}:
                            <span className="text-muted-foreground font-normal"> “{orderBannerMsg.body?.slice(0, 90)}{((orderBannerMsg.body || '').length > 90) ? '…' : ''}”</span>
                        </span>
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleContextConvertToOrder(orderBannerMsg as unknown as WPPMessage)}
                                className="text-xs font-bold bg-primary text-primary-foreground px-3 py-1.5 rounded-lg hover:bg-primary/90 transition-colors"
                            >
                                Create Draft Order
                            </button>
                            <button
                                onClick={() => handleContextGeneratePayLink()}
                                className="text-xs font-bold bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-500 transition-colors"
                            >
                                Send Payment Link
                            </button>
                            <button
                                onClick={() => setOrderBannerMsg(null)}
                                className="text-xs text-muted-foreground hover:text-foreground px-2"
                                title="Dismiss"
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                )}

                <div className="flex h-full gap-4 min-w-0 overflow-hidden">

                    {/* LEFT: Chats List */}
                    <div className={`w-full md:w-80 lg:w-[350px] shrink-0 bg-card rounded-xl border border-border flex flex-col overflow-hidden ${selectedChat ? 'hidden md:flex' : 'flex'}`}>
                        <div className="p-3.5 border-b border-border bg-muted/20 flex flex-col gap-2">
                            <div className="flex justify-between items-center gap-2">
                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-sm">Active Chats</span>
                                    {(loadingChats || sessionStatus === "connecting") && (
                                        <div className="flex items-center gap-1 text-xs text-primary animate-pulse">
                                            <RefreshCw size={12} className="animate-spin" />
                                            <span className="text-[11px]">Syncing...</span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex gap-1.5 items-center">
                                    {/* Apple-style Tag Layout Toggle */}
                                    <div className="flex items-center bg-muted/70 p-0.5 rounded-md border border-border/40 text-[10px]">
                                        <button
                                            onClick={() => {
                                                setBadgeLayout('inline');
                                                try { localStorage.setItem('wa_badge_layout', 'inline'); } catch {}
                                            }}
                                            className={`px-1.5 py-0.5 rounded font-semibold transition-all ${
                                                badgeLayout === 'inline'
                                                    ? 'bg-background text-foreground shadow-xs'
                                                    : 'text-muted-foreground hover:text-foreground'
                                            }`}
                                            title="Inline: Tags beside names with smooth hover marquee"
                                        >
                                            Inline
                                        </button>
                                        <button
                                            onClick={() => {
                                                setBadgeLayout('subtitle');
                                                try { localStorage.setItem('wa_badge_layout', 'subtitle'); } catch {}
                                            }}
                                            className={`px-1.5 py-0.5 rounded font-semibold transition-all ${
                                                badgeLayout === 'subtitle'
                                                    ? 'bg-background text-foreground shadow-xs'
                                                    : 'text-muted-foreground hover:text-foreground'
                                            }`}
                                            title="Stacked: Tags on preview line, 100% width for names"
                                        >
                                            Stacked
                                        </button>
                                    </div>

                                    {sessionStatus === "connected" && !loadingChats && (
                                        <button
                                            onClick={() => loadExistingChats()}
                                            className="p-1.5 rounded-lg bg-muted/60 hover:bg-muted text-foreground transition-colors"
                                            title="Refresh chat list"
                                        >
                                            <RefreshCw size={13} />
                                        </button>
                                    )}
                                    {sessionStatus === "disconnected" && (
                                        <button onClick={() => handleConnect(false)} className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:opacity-90">Connect</button>
                                    )}
                                    {sessionStatus === "connected" && (
                                        <button onClick={handleDisconnect} className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors">Log Out</button>
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

                        {(sessionStatus === "qr" || !!pairingCode) && (
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
                                                <Image src={qrCode} width={256} height={256} className="w-64 h-64 object-contain" alt="QR Code" />
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
                                                    3. Tap <b>&quot;Link with phone number instead&quot;</b><br />
                                                    4. Enter the code shown above
                                                </div>

                                                <button
                                                    onClick={() => {
                                                        setPairingCode(null);
                                                        if (phonePollRef.current) {
                                                            clearInterval(phonePollRef.current);
                                                            phonePollRef.current = null;
                                                        }
                                                    }}
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

                        {/* Chat Category Filter: Dropdown on Mobile/Narrow, Pill Buttons on Desktop */}
                        <div className="block sm:hidden p-2 border-b border-border bg-background/50">
                            {(() => {
                                const vendorCount = chats.filter(c => chatTypeMap[c.id] === 'vendor' || chatLabelsMap[c.id]?.includes('vendor_group')).length;
                                const vendorGroupCount = chats.filter(c => chatLabelsMap[c.id]?.includes('vendor_group') || ((c.isGroup || c.id.includes('@g.us')) && chatTypeMap[c.id] === 'vendor')).length;
                                const communityCount = chats.filter(c => c.isCommunity || c.isCommunityAnnounce || chatLabelsMap[c.id]?.includes('community_announcement') || (c.name || '').toLowerCase().includes('announcement') || (c.name || '').toLowerCase().includes('community')).length;

                                const filterLabelMap: Record<string, string> = {
                                    all: `All Chats (${chats.length})`,
                                    vendor: `Vendors (${vendorCount})`,
                                    vendor_group: `Vendor Groups (${vendorGroupCount})`,
                                    community: `Communities (${communityCount})`,
                                    group: 'Groups & Channels',
                                    customer: 'Customers',
                                };

                                return (
                                    <Select value={chatFilter} onValueChange={(v) => v && setChatFilter(v as any)}>
                                        <SelectTrigger className="w-full h-9 bg-card border-border text-xs font-semibold px-2.5 rounded-lg flex items-center justify-between shadow-xs">
                                            <span className="text-xs font-semibold text-foreground">
                                                {filterLabelMap[chatFilter] || 'All Chats'}
                                            </span>
                                        </SelectTrigger>
                                        <SelectContent className="bg-popover border-border">
                                            <SelectItem value="all" className="text-xs font-medium py-2">
                                                All Chats ({chats.length})
                                            </SelectItem>
                                            <SelectItem value="vendor" className="text-xs font-medium py-2">
                                                Vendors ({vendorCount})
                                            </SelectItem>
                                            <SelectItem value="vendor_group" className="text-xs font-medium py-2">
                                                Vendor Groups ({vendorGroupCount})
                                            </SelectItem>
                                            <SelectItem value="community" className="text-xs font-medium py-2">
                                                Communities ({communityCount})
                                            </SelectItem>
                                            <SelectItem value="group" className="text-xs font-medium py-2">
                                                Groups &amp; Channels
                                            </SelectItem>
                                            <SelectItem value="customer" className="text-xs font-medium py-2">
                                                Customers
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                );
                            })()}
                        </div>

                        <div className="hidden sm:flex flex-wrap items-center gap-1.5 p-2 border-b border-border bg-background/50 text-[11px]">
                            <button
                                onClick={() => setChatFilter('all')}
                                className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                                    chatFilter === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                                }`}
                            >
                                All ({chats.length})
                            </button>
                            <button
                                onClick={() => setChatFilter('vendor')}
                                className={`px-2.5 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
                                    chatFilter === 'vendor' ? 'bg-indigo-600 text-white' : 'text-muted-foreground hover:bg-muted'
                                }`}
                                title="All vendors (individual supplier contacts and vendor drop groups)"
                            >
                                <Building2 size={11} />
                                Vendors ({chats.filter(c => chatTypeMap[c.id] === 'vendor' || chatLabelsMap[c.id]?.includes('vendor_group')).length})
                            </button>
                            <button
                                onClick={() => setChatFilter('vendor_group')}
                                className={`px-2.5 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
                                    chatFilter === 'vendor_group' ? 'bg-purple-600 text-white' : 'text-muted-foreground hover:bg-muted'
                                }`}
                                title="Vendor groups where product drops, catalogs, and supplier rates are received"
                            >
                                <Building2 size={11} />
                                Vendor Groups ({chats.filter(c => chatLabelsMap[c.id]?.includes('vendor_group') || ((c.isGroup || c.id.includes('@g.us')) && chatTypeMap[c.id] === 'vendor')).length})
                            </button>
                            <button
                                onClick={() => setChatFilter('community')}
                                className={`px-2.5 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
                                    chatFilter === 'community' ? 'bg-amber-600 text-white' : 'text-muted-foreground hover:bg-muted'
                                }`}
                                title="WhatsApp Communities & Community Announcement channels"
                            >
                                <Megaphone size={11} />
                                Communities ({chats.filter(c => c.isCommunity || c.isCommunityAnnounce || chatLabelsMap[c.id]?.includes('community_announcement') || (c.name || '').toLowerCase().includes('announcement') || (c.name || '').toLowerCase().includes('community')).length})
                            </button>
                            <button
                                onClick={() => setChatFilter('group')}
                                className={`px-2.5 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
                                    chatFilter === 'group' ? 'bg-sky-600 text-white' : 'text-muted-foreground hover:bg-muted'
                                }`}
                            >
                                <Users size={12} />
                                Groups &amp; Channels
                            </button>
                            <button
                                onClick={() => setChatFilter('customer')}
                                className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                                    chatFilter === 'customer' ? 'bg-emerald-600 text-white' : 'text-muted-foreground hover:bg-muted'
                                }`}
                            >
                                Customers
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto">
                            {chats.filter((c) => {
                                const isGrp = c.isGroup || c.id.includes('@g.us');
                                const isChan = c.id.includes('@newsletter');
                                const isVendorGrp = chatLabelsMap[c.id]?.includes('vendor_group') || (isGrp && chatTypeMap[c.id] === 'vendor');
                                const isComm = Boolean(c.isCommunity || c.isCommunityAnnounce || chatLabelsMap[c.id]?.includes('community_announcement') || (c.name || '').toLowerCase().includes('announcement') || (c.name || '').toLowerCase().includes('community'));

                                if (chatFilter === 'vendor') return chatTypeMap[c.id] === 'vendor' || isVendorGrp;
                                if (chatFilter === 'vendor_group') return isVendorGrp;
                                if (chatFilter === 'community') return isComm;
                                if (chatFilter === 'group') return isGrp || isChan;
                                if (chatFilter === 'customer') return chatTypeMap[c.id] === 'customer';
                                return true;
                            }).map(chat => {
                                const isGrp = chat.isGroup || chat.id.includes('@g.us');
                                const isChan = chat.id.includes('@newsletter');
                                const isVendorGrp = chatLabelsMap[chat.id]?.includes('vendor_group') || (isGrp && chatTypeMap[chat.id] === 'vendor');
                                const isCommAnnounce = Boolean(chat.isCommunityAnnounce || chatLabelsMap[chat.id]?.includes('community_announcement') || (isGrp && ((chat.name || '').toLowerCase().includes('announcement') || (chat.name || '').toLowerCase().includes('announcements'))));

                                const badgeElement = isChan ? (
                                    <span className="text-[8.5px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/25 shrink-0 whitespace-nowrap shadow-xs">
                                        Channel
                                    </span>
                                ) : isVendorGrp ? (
                                    <span className="text-[8.5px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1 shrink-0 whitespace-nowrap shadow-xs">
                                        <Building2 size={9} /> Vendor Group
                                    </span>
                                ) : isCommAnnounce ? (
                                    <span className="text-[8.5px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1 shrink-0 whitespace-nowrap shadow-xs">
                                        <Megaphone size={9} /> Announcement
                                    </span>
                                ) : chat.isCommunity ? (
                                    <span className="text-[8.5px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center gap-1 shrink-0 whitespace-nowrap shadow-xs">
                                        <Users size={9} /> Community
                                    </span>
                                ) : isGrp ? (
                                    <span className="text-[8.5px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/25 shrink-0 whitespace-nowrap shadow-xs">
                                        Group
                                    </span>
                                ) : chatTypeMap[chat.id] ? (
                                    <span className={`text-[8.5px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap shadow-xs ${
                                        chatTypeMap[chat.id] === 'vendor' ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/25'
                                        : chatTypeMap[chat.id] === 'customer' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                                        : 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                                    }`}>
                                        {chatTypeMap[chat.id]}
                                    </span>
                                ) : null;

                                return (
                                <div
                                    key={chat.id}
                                    onClick={() => {
                                        setSelectedChat(chat.id);
                                        markChatAsReadLocally(chat.id);
                                    }}
                                    className={`group p-3 border-b border-border cursor-pointer hover:bg-muted/50 transition-colors flex gap-3 ${selectedChat === chat.id ? 'bg-primary/10 border-l-4 border-l-primary' : ''}`}
                                >
                                    {/* Profile Pic / Avatar */}
                                    <ChatAvatar
                                        profilePic={chat.profilePic}
                                        name={chat.name}
                                        isChan={isChan}
                                        isVendorGrp={isVendorGrp}
                                        isCommAnnounce={isCommAnnounce}
                                        isGrp={isGrp}
                                        size={40}
                                    />
                                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                                        {/* Row 1: Chat Name with Smooth Marquee + (Inline Badge if selected) + Timestamp */}
                                        <div className="flex justify-between items-center gap-1.5 min-w-0">
                                            <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                                                <MarqueeText
                                                    text={chat.name || 'Unknown Chat'}
                                                    className="font-bold text-sm text-foreground flex-1 min-w-0"
                                                />
                                                {badgeLayout === 'inline' && badgeElement}
                                            </div>
                                            <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                                                {new Date(chat.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>

                                        {/* Row 2: (Stacked Badge if selected) + Last Message Snippet + Unread Counter */}
                                        <div className="flex items-center justify-between gap-1.5 mt-0.5 min-w-0">
                                            <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
                                                {badgeLayout === 'subtitle' && badgeElement}
                                                <p className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                                                    {chat.lastMessage || <span className="italic opacity-50">No messages yet</span>}
                                                </p>
                                            </div>
                                            {chat.unreadCount > 0 && (
                                                <span className="text-[10px] font-bold bg-primary text-primary-foreground min-w-4 h-4 px-1 rounded-full flex items-center justify-center shrink-0 shadow-xs">
                                                    {chat.unreadCount}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );})}
                        </div>
                    </div>

                    {/* MIDDLE: Chat Window */}
                    <div className={`flex-1 min-w-[320px] bg-card rounded-xl border border-border flex flex-col overflow-hidden relative ${!selectedChat ? 'hidden md:flex' : 'flex'}`}>
                        {selectedChat ? (
                            <>
                                <div className="h-14 border-b border-border flex items-center px-4 bg-background/50 backdrop-blur justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <button
                                            onClick={() => setSelectedChat(null)}
                                            className="md:hidden p-1.5 -ml-1 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors shrink-0"
                                            title="Back to chat list"
                                        >
                                            <ChevronLeft size={18} />
                                        </button>
                                        {(() => {
                                            const activeChat = chats.find(c => c.id === selectedChat);
                                            const isChan = Boolean(selectedChat?.includes('@newsletter'));
                                            const isGrp = Boolean(selectedChat?.includes('@g.us') || activeChat?.isGroup);
                                            const isVendorGrp = Boolean(chatTypeMap[selectedChat!] === 'vendor' || chatLabelsMap[selectedChat!]?.includes('vendor_group'));
                                            const isCommAnnounce = Boolean(activeChat?.isCommunityAnnounce || chatLabelsMap[selectedChat!]?.includes('community_announcement') || (activeChat?.name || '').toLowerCase().includes('announcement'));

                                            return (
                                                <ChatAvatar
                                                    profilePic={activeChat?.profilePic}
                                                    name={activeChat?.name}
                                                    isChan={isChan}
                                                    isVendorGrp={isVendorGrp}
                                                    isCommAnnounce={isCommAnnounce}
                                                    isGrp={isGrp}
                                                    size={32}
                                                />
                                            );
                                        })()}
                                        <MarqueeText
                                            text={chats.find(c => c.id === selectedChat)?.name || ''}
                                            className="font-bold text-sm text-foreground max-w-[200px] sm:max-w-[300px] md:max-w-[380px]"
                                        />
                                        {/* Group / Channel / Community / Vendor Group indicator or 1-click contact-type toggle */}
                                        {selectedChat.includes('@newsletter') ? (
                                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 flex items-center gap-1 shrink-0">
                                                <Radio size={11} /> Channel
                                            </span>
                                        ) : (selectedChat.includes('@g.us') || chats.find(c => c.id === selectedChat)?.isGroup) ? (
                                            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                                                {/* Community Announcement indicator */}
                                                {(chats.find(c => c.id === selectedChat)?.isCommunityAnnounce || chatLabelsMap[selectedChat]?.includes('community_announcement') || (chats.find(c => c.id === selectedChat)?.name || '').toLowerCase().includes('announcement')) && (
                                                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                                                        <Megaphone size={11} /> Community Announcement
                                                    </span>
                                                )}
                                                {/* Vendor Group toggle button */}
                                                {(chatTypeMap[selectedChat] === 'vendor' || chatLabelsMap[selectedChat]?.includes('vendor_group')) ? (
                                                    <button
                                                        onClick={handleToggleVendorGroup}
                                                        title="Click to remove Vendor Group tag"
                                                        className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 border border-indigo-500/40 flex items-center gap-1 transition-colors"
                                                    >
                                                        <Building2 size={11} /> Vendor Group
                                                        <span className="text-[9px] text-muted-foreground hover:text-foreground ml-1">✕</span>
                                                    </button>
                                                ) : (
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 flex items-center gap-1">
                                                            <Users size={11} /> Group
                                                        </span>
                                                        <button
                                                            onClick={handleToggleVendorGroup}
                                                            title="Tag this group as a Vendor Group (where you receive new product updates & vendor pricing)"
                                                            className="text-[10px] font-semibold px-2 py-0.5 rounded bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/25 flex items-center gap-1 transition-colors"
                                                        >
                                                            <Building2 size={10} /> + Tag as Vendor Group
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <button
                                                onClick={handleToggleContactType}
                                                title="Toggle Customer / Vendor / Lead"
                                                className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded transition-colors shrink-0 ${
                                                    contactType === 'vendor' ? 'bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25'
                                                    : contactType === 'customer' ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                                                    : 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
                                                }`}
                                            >
                                                {contactType}
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <label className="text-xs hidden sm:flex items-center gap-1 cursor-pointer select-none">
                                            <input type="checkbox" checked={autoReplyEnabled} onChange={e => setAutoReplyEnabled(e.target.checked)} className="accent-primary" />
                                            Auto-Reply
                                        </label>
                                        <button
                                            onClick={() => setShowConciergePanel(prev => !prev)}
                                            className={`p-1.5 rounded-lg border transition-colors ${showConciergePanel ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                                            title={showConciergePanel ? "Hide Concierge Sidebar" : "Show Concierge Sidebar"}
                                        >
                                            {showConciergePanel ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                                        </button>
                                    </div>
                                </div>

                                <div
                                    {...longPressHandlers}
                                    className={`flex-1 overflow-y-auto p-4 space-y-3 bg-muted/10 ${longPressing ? 'select-none' : ''}`}
                                >
                                    {selectedChatMessages.map(msg => {
                                        const stanzaId = getMessageStanzaId(msg.id);
                                        return (
                                            <div
                                                key={msg.id}
                                                id={`msg-${msg.id}`}
                                                data-msg-id={msg.id}
                                                data-stanza-id={stanzaId}
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    setActionMenu({
                                                        isOpen: true,
                                                        message: msg as unknown as WPPMessage,
                                                        position: { x: e.clientX, y: e.clientY }
                                                    });
                                                }}
                                                className={`flex items-center gap-1 transition-all duration-300 group relative ${msg.fromMe ? 'justify-end' : 'justify-start'}`}
                                            >
                                                {!msg.fromMe && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const rect = e.currentTarget.getBoundingClientRect();
                                                            setActionMenu({
                                                                isOpen: true,
                                                                message: msg as unknown as WPPMessage,
                                                                position: { x: rect.left, y: rect.bottom + 4 }
                                                            });
                                                        }}
                                                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted/80 rounded-md text-muted-foreground hover:text-foreground"
                                                        title="Message Actions"
                                                    >
                                                        <MoreVertical size={13} />
                                                    </button>
                                                )}
                                                <div className={`max-w-[80%] p-3 rounded-xl text-sm ${msg.fromMe ? 'bg-primary text-primary-foreground rounded-br-none' : 'bg-card border border-border rounded-tl-none'}`}>
                                                    {!msg.fromMe && (selectedChat.includes('@g.us') || selectedChat.includes('@newsletter') || chats.find(c => c.id === selectedChat)?.isGroup) && msg.fromName && (
                                                        <p className="text-[11px] font-bold text-primary mb-1 truncate">
                                                            {msg.fromName}
                                                        </p>
                                                    )}
                                                    <MessageContent
                                                        msg={msg}
                                                        onLoadMedia={id => whatsappManager.downloadMedia(id)}
                                                        onFindSimilar={handleFindSimilar}
                                                        chatMessages={selectedChatMessages}
                                                    />
                                                </div>
                                                {msg.fromMe && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const rect = e.currentTarget.getBoundingClientRect();
                                                            setContextMenu({
                                                                isOpen: true,
                                                                message: msg as ChatMenuMessage,
                                                                position: { x: rect.left, y: rect.bottom + 4 }
                                                            });
                                                        }}
                                                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted/80 rounded-md text-muted-foreground hover:text-foreground"
                                                        title="Message Actions"
                                                    >
                                                        <MoreVertical size={13} />
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Attachment Preview */}
                                {attachmentFile && (
                                    <div className="px-3 py-2 bg-muted/50 border-t border-border flex items-center gap-2">
                                        {attachmentPreview ? (
                                            <Image src={attachmentPreview} alt="Preview" width={64} height={64} className="w-16 h-16 object-cover rounded-lg" />
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
                                <div className="p-3 bg-card border-t border-border flex gap-2 items-center relative">
                                    {/* Slash Command Palette */}
                                    <SlashCommandPalette
                                        isOpen={slashPaletteOpen}
                                        query={slashQuery}
                                        onClose={() => setSlashPaletteOpen(false)}
                                        onSelectSnippet={handleSelectSlashSnippet}
                                        onTriggerAction={handleTriggerSlashAction}
                                    />

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

                                    {/* Quick Razorpay Link Button */}
                                    <button
                                        onClick={() => {
                                            const cartTotal = cart.reduce((acc, item) => acc + item.base_price * (item.quantity || 1), 0);
                                            setRazorpayModalAmount(cartTotal || 0);
                                            setShowRazorpayModal(true);
                                        }}
                                        className="p-2 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10 rounded-lg transition-colors font-bold text-xs flex items-center gap-1"
                                        title="Create Razorpay Payment Link"
                                    >
                                        <CreditCard size={18} />
                                    </button>

                                    {/* Slash Helper Button */}
                                    <button
                                        onClick={() => {
                                            setSlashQuery("/");
                                            setSlashPaletteOpen(prev => !prev);
                                        }}
                                        className={`w-8 h-8 rounded-lg transition-colors font-mono text-xs font-bold flex items-center justify-center ${slashPaletteOpen ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                                        title="Canned Templates & Commands (/)"
                                    >
                                        /
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
                                            placeholder={attachmentFile ? "Add a caption..." : "Type a message or / for templates..."}
                                            value={replyText}
                                            onChange={e => {
                                                const val = e.target.value;
                                                setReplyText(val);
                                                if (val.startsWith('/')) {
                                                    setSlashQuery(val);
                                                    setSlashPaletteOpen(true);
                                                } else if (slashPaletteOpen) {
                                                    setSlashPaletteOpen(false);
                                                }
                                            }}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && !slashPaletteOpen) {
                                                    if (attachmentFile) { handleSendAttachment(); } else { sendReply(); }
                                                }
                                            }}
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
                    {showConciergePanel && (
                        <div className="w-80 xl:w-96 shrink-0 bg-card rounded-xl border border-border flex flex-col overflow-hidden">
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

                                    {/* CUSTOMER PANEL - 360° Jewelry CRM */}
                                    {activePanel === 'customer' && (
                                        <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-4">
                                            {loadingCustomer ? (
                                                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground py-12">
                                                    <Loader2 size={24} className="animate-spin mb-2" />
                                                    <p className="text-xs">Loading profile...</p>
                                                </div>
                                            ) : customer ? (
                                                <div className="space-y-4">
                                                    <div className="text-center">
                                                        {(() => {
                                                            const activeChat = chats.find(c => c.id === selectedChat);
                                                            const isChan = Boolean(selectedChat?.includes('@newsletter'));
                                                            const isGrp = Boolean(selectedChat?.includes('@g.us') || activeChat?.isGroup);
                                                            const isVendorGrp = Boolean(chatTypeMap[selectedChat!] === 'vendor' || chatLabelsMap[selectedChat!]?.includes('vendor_group'));
                                                            const isCommAnnounce = Boolean(activeChat?.isCommunityAnnounce || chatLabelsMap[selectedChat!]?.includes('community_announcement') || (activeChat?.name || '').toLowerCase().includes('announcement'));

                                                            return (
                                                                <div className="flex justify-center mb-2">
                                                                    <ChatAvatar
                                                                        profilePic={activeChat?.profilePic}
                                                                        name={customer.name || activeChat?.name}
                                                                        isChan={isChan}
                                                                        isVendorGrp={isVendorGrp}
                                                                        isCommAnnounce={isCommAnnounce}
                                                                        isGrp={isGrp}
                                                                        size={56}
                                                                    />
                                                                </div>
                                                            );
                                                        })()}
                                                        <h2 className="text-base font-bold">{customer.name}</h2>
                                                        <p className="text-xs text-muted-foreground">{customer.phone}</p>
                                                        <div className="flex justify-center items-center gap-1.5 mt-2 flex-wrap">
                                                            <span className="text-[10px] bg-blue-500/20 text-blue-500 px-2 py-0.5 rounded-full uppercase font-bold tracking-wider">
                                                                {customer.customer_type}
                                                            </span>
                                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                                                customer.lead_status === 'won' || customer.lead_status === 'vip' ? 'bg-emerald-500/20 text-emerald-500' :
                                                                customer.lead_status === 'awaiting_payment' ? 'bg-orange-500/20 text-orange-500' :
                                                                customer.lead_status === 'quoted' ? 'bg-amber-500/20 text-amber-500' :
                                                                'bg-purple-500/20 text-purple-500'
                                                            }`}>
                                                                ● {(customer.lead_status || 'new_lead').replace('_', ' ')}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* Financial Stats */}
                                                    <div className="grid grid-cols-3 gap-2">
                                                        <div className="bg-muted/30 p-2.5 rounded-xl text-center">
                                                            <p className="text-[10px] text-muted-foreground mb-0.5">Total Spent</p>
                                                            <p className="font-bold text-xs text-primary">{formatPrice(customer.total_spent)}</p>
                                                        </div>
                                                        <div className="bg-muted/30 p-2.5 rounded-xl text-center">
                                                            <p className="text-[10px] text-muted-foreground mb-0.5">Orders</p>
                                                            <p className="font-bold text-xs">{customer.total_orders}</p>
                                                        </div>
                                                        <div className="bg-muted/30 p-2.5 rounded-xl text-center">
                                                            <p className="text-[10px] text-muted-foreground mb-0.5">Loyalty Pts</p>
                                                            <p className="font-bold text-xs text-emerald-500">{customer.loyalty_points || 0}</p>
                                                        </div>
                                                    </div>

                                                    {/* 360° Jewelry Sizing & Preferences */}
                                                    <div className="bg-card border border-border rounded-xl p-3.5 space-y-3">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                                                                <Sparkles size={13} className="text-primary" />
                                                                Jewelry Preferences
                                                            </span>
                                                            <button
                                                                onClick={() => setEditingCRM(prev => !prev)}
                                                                className="text-[10px] text-primary hover:underline font-bold"
                                                            >
                                                                {editingCRM ? "Cancel" : "Edit"}
                                                            </button>
                                                        </div>

                                                        {editingCRM ? (
                                                            <div className="space-y-2.5">
                                                                <div className="grid grid-cols-2 gap-2">
                                                                    <div>
                                                                        <label className="text-[10px] text-muted-foreground">Ring Size</label>
                                                                        <input
                                                                            type="text"
                                                                            placeholder="e.g. 12, 14"
                                                                            value={crmForm.ring_size}
                                                                            onChange={e => setCrmForm({ ...crmForm, ring_size: e.target.value })}
                                                                            className="w-full bg-muted rounded px-2 py-1 text-xs border border-border"
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <label className="text-[10px] text-muted-foreground">Bangle Size</label>
                                                                        <input
                                                                            type="text"
                                                                            placeholder="e.g. 2-4, 2-6"
                                                                            value={crmForm.bangle_size}
                                                                            onChange={e => setCrmForm({ ...crmForm, bangle_size: e.target.value })}
                                                                            className="w-full bg-muted rounded px-2 py-1 text-xs border border-border"
                                                                        />
                                                                    </div>
                                                                </div>

                                                                <div>
                                                                    <label className="text-[10px] text-muted-foreground">Preferred Metal Style</label>
                                                                    <select
                                                                        value={crmForm.preferred_metal}
                                                                        onChange={e => setCrmForm({ ...crmForm, preferred_metal: e.target.value })}
                                                                        className="w-full bg-muted rounded px-2 py-1 text-xs border border-border"
                                                                    >
                                                                        <option value="Rose Gold">Rose Gold</option>
                                                                        <option value="Yellow Gold">Yellow Gold</option>
                                                                        <option value="Silver">Silver / Platinum Finish</option>
                                                                        <option value="Antique">Antique / Oxidized</option>
                                                                        <option value="Kundan">Kundan / Polki</option>
                                                                    </select>
                                                                </div>

                                                                <div className="grid grid-cols-2 gap-2">
                                                                    <div>
                                                                        <label className="text-[10px] text-muted-foreground">Anniversary</label>
                                                                        <input
                                                                            type="date"
                                                                            value={crmForm.anniversary_date}
                                                                            onChange={e => setCrmForm({ ...crmForm, anniversary_date: e.target.value })}
                                                                            className="w-full bg-muted rounded px-1.5 py-1 text-xs border border-border"
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <label className="text-[10px] text-muted-foreground">Birthday</label>
                                                                        <input
                                                                            type="date"
                                                                            value={crmForm.birthday_date}
                                                                            onChange={e => setCrmForm({ ...crmForm, birthday_date: e.target.value })}
                                                                            className="w-full bg-muted rounded px-1.5 py-1 text-xs border border-border"
                                                                        />
                                                                    </div>
                                                                </div>

                                                                <div>
                                                                    <label className="text-[10px] text-muted-foreground">Lead Pipeline Stage</label>
                                                                    <select
                                                                        value={crmForm.lead_status}
                                                                        onChange={e => setCrmForm({ ...crmForm, lead_status: e.target.value as CustomerLeadStatus })}
                                                                        className="w-full bg-muted rounded px-2 py-1 text-xs border border-border"
                                                                    >
                                                                        <option value="new_lead">New Lead</option>
                                                                        <option value="contacted">Contacted</option>
                                                                        <option value="quoted">Quoted</option>
                                                                        <option value="awaiting_payment">Awaiting Payment</option>
                                                                        <option value="won">Deal Won</option>
                                                                        <option value="vip">VIP Member</option>
                                                                    </select>
                                                                </div>

                                                                <button
                                                                    onClick={handleSaveCRMProfile}
                                                                    disabled={savingCRM}
                                                                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold py-2 rounded-lg transition-all flex items-center justify-center gap-1.5"
                                                                >
                                                                    {savingCRM ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                                                                    Save 360° Profile
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                                                <div className="bg-muted/20 p-2 rounded-lg">
                                                                    <span className="text-[10px] text-muted-foreground block">Ring Size</span>
                                                                    <span className="font-bold">{customer.ring_size || "Not set"}</span>
                                                                </div>
                                                                <div className="bg-muted/20 p-2 rounded-lg">
                                                                    <span className="text-[10px] text-muted-foreground block">Bangle Size</span>
                                                                    <span className="font-bold">{customer.bangle_size || "Not set"}</span>
                                                                </div>
                                                                <div className="bg-muted/20 p-2 rounded-lg col-span-2">
                                                                    <span className="text-[10px] text-muted-foreground block">Preferred Metal</span>
                                                                    <span className="font-bold">{customer.preferred_metal || "Rose Gold / Fashion"}</span>
                                                                </div>
                                                                {customer.anniversary_date && (
                                                                    <div className="bg-pink-500/10 p-2 rounded-lg col-span-2 text-pink-600 font-medium">
                                                                        💍 Anniversary: {customer.anniversary_date}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {customer.notes && (
                                                        <div className="bg-yellow-500/10 border border-yellow-500/20 p-3 rounded-lg">
                                                            <p className="text-xs font-bold text-yellow-600 mb-1 flex items-center gap-1"><Tag size={10} /> Notes</p>
                                                            <p className="text-xs text-muted-foreground italic">&quot;{customer.notes}&quot;</p>
                                                        </div>
                                                    )}

                                                    <button onClick={() => window.open(`/customers/detail?id=${customer.id}`, '_blank')} className="w-full border border-border hover:bg-muted text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-2 transition-colors">
                                                        <ExternalLink size={14} /> View Full Profile in CRM
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
                                                    Sync your PocketBase inventory with WhatsApp Business Catalog automatically.
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

                                                <div className="flex flex-col gap-2">
                                                    <button
                                                        onClick={() => setShowCatalogEditorModal(true)}
                                                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all shadow-sm active:scale-95"
                                                    >
                                                        <Store size={14} /> Edit Catalog & Inventory Sync
                                                    </button>
                                                    <button
                                                        onClick={() => setShowCatalogSyncModal(true)}
                                                        className="w-full bg-secondary hover:bg-secondary/80 text-secondary-foreground font-semibold text-xs py-2 rounded-lg flex items-center justify-center gap-2 transition-all border border-border active:scale-95"
                                                    >
                                                        <Package size={14} /> Open Batch Publisher
                                                    </button>
                                                </div>
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
                    )}

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
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => setShowMatchModal(false)}>
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
                                            <Image src={match.product.image_url} alt="" width={64} height={64} className="w-full h-full object-cover" />
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
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
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
                                    <Image
                                        src={selectedMessageImage || addProductForm.image_url}
                                        alt="Product"
                                        width={128}
                                        height={128}
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
                                            if (!id) return;
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
                                            <SelectValue />
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
                                            if (!v) return;
                                            setAddProductForm(f => ({ ...f, category: v }));
                                            generateSKU(v, attributeValues);
                                        }}
                                    >
                                        <SelectTrigger className="w-full bg-muted border-0">
                                            <SelectValue />
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
                                                            if (!v) return;
                                                            const newVals = { ...attributeValues, [attr.id || '']: v };
                                                            setAttributeValues(newVals);
                                                            generateSKU(addProductForm.category, newVals);
                                                        }}
                                                    >
                                                        <SelectTrigger className="w-full bg-muted border-0">
                                                            <SelectValue />
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

            {/* Message Context Menu */}
            <ChatContextMenu
                isOpen={contextMenu.isOpen}
                message={contextMenu.message}
                position={contextMenu.position}
                onClose={() => setContextMenu({ isOpen: false, message: null, position: null })}
                onAddToCart={handleContextAddToCart}
                onGeneratePayLink={handleContextGeneratePayLink}
                onConvertToOrder={handleContextConvertToOrder}
                onAddExistingInventory={(msg) => {
                    const text = msg.caption || msg.body || '';
                    const activeChatObj = chats.find(c => c.id === selectedChat);
                    setIngestSourceContext({
                        chatName: activeChatObj?.name,
                        senderName: msg.sender?.pushname || msg.sender?.name || (msg as WPPMessageWithFromName)?.fromName,
                        isGroup: selectedChat?.includes('@g.us') || !!activeChatObj?.isGroup,
                        isChannel: selectedChat?.includes('@newsletter'),
                    });
                    setAddInventoryMsg(text);
                }}
                onCreateProduct={async (msg) => {
                    const text = msg.caption || msg.body || '';
                    const activeChatObj = chats.find(c => c.id === selectedChat);
                    setIngestSourceContext({
                        chatName: activeChatObj?.name,
                        senderName: msg.sender?.pushname || msg.sender?.name || (msg as WPPMessageWithFromName)?.fromName,
                        isGroup: selectedChat?.includes('@g.us') || !!activeChatObj?.isGroup,
                        isChannel: selectedChat?.includes('@newsletter'),
                    });

                    let imageToUse: string | null = msg.mediaUrl || null;
                    if (msg.id && (!imageToUse || imageToUse.includes('whatsapp.net') || imageToUse.startsWith('http'))) {
                        try {
                            const decrypted = await whatsappManager.downloadMedia(msg.id);
                            if (decrypted) imageToUse = decrypted;
                        } catch (e) {
                            console.warn('[onCreateProduct] downloadMedia error:', e);
                        }
                    }
                    setVendorIngestImage(imageToUse);
                    setVendorIngestMsg(text);
                }}
                onSetLeadStatus={handleContextSetLeadStatus}
                onOpenCustomerCRM={() => setActivePanel('customer')}
                onQuoteReply={msg => setReplyText(`> ${msg.body || ''}\n\n`)}
            />

            {/* Context Action Engine — long-press / right-click (spec §8) */}
            <MessageActionMenu
                isOpen={actionMenu.isOpen}
                onClose={() => setActionMenu({ isOpen: false, message: null, position: null })}
                contactType={contactType}
                isGroupOrChannel={selectedChat?.includes('@g.us') || selectedChat?.includes('@newsletter') || !!chats.find(c => c.id === selectedChat)?.isGroup}
                isChannel={selectedChat?.includes('@newsletter')}
                senderName={actionMenu.message?.sender?.pushname || actionMenu.message?.sender?.name || (actionMenu.message as WPPMessageWithFromName)?.fromName}
                chatName={chats.find(c => c.id === selectedChat)?.name}
                position={actionMenu.position}
                detectedAmount={(() => {
                    const m = (actionMenu.message?.caption || actionMenu.message?.body || '').match(/₹?\s*([\d,]{2,7})/);
                    return m ? parseInt(m[1].replace(/,/g, ''), 10) : undefined;
                })()}
                detectedSku={extractVariantHints(actionMenu.message?.caption || actionMenu.message?.body || '').sku}
                onAddToCart={() => handleBroadcastToPOS(actionMenu.message!)}
                onCreateQuote={() => handleContextConvertToOrder(actionMenu.message!)}
                onSendPaymentLink={() => handleContextGeneratePayLink(undefined)}
                onSendProductCard={() => handleSendProductCard(actionMenu.message!)}
                onAddExistingInventory={() => {
                    const m = actionMenu.message;
                    const text = m?.caption || m?.body || '';
                    const activeChatObj = chats.find(c => c.id === selectedChat);
                    setIngestSourceContext({
                        chatName: activeChatObj?.name,
                        senderName: m?.sender?.pushname || m?.sender?.name || (m as WPPMessageWithFromName)?.fromName,
                        isGroup: selectedChat?.includes('@g.us') || !!activeChatObj?.isGroup,
                        isChannel: selectedChat?.includes('@newsletter'),
                    });
                    setAddInventoryMsg(text);
                }}
                onCreateProduct={async () => {
                    const m = actionMenu.message;
                    const text = m?.caption || m?.body || '';
                    const activeChatObj = chats.find(c => c.id === selectedChat);
                    setIngestSourceContext({
                        chatName: activeChatObj?.name,
                        senderName: m?.sender?.pushname || m?.sender?.name || (m as WPPMessageWithFromName)?.fromName,
                        isGroup: selectedChat?.includes('@g.us') || !!activeChatObj?.isGroup,
                        isChannel: selectedChat?.includes('@newsletter'),
                    });

                    let imageToUse: string | null = m?.mediaUrl || null;
                    if (m?.id && (!imageToUse || imageToUse.includes('whatsapp.net') || imageToUse.startsWith('http'))) {
                        try {
                            const decrypted = await whatsappManager.downloadMedia(m.id);
                            if (decrypted) imageToUse = decrypted;
                        } catch (e) {
                            console.warn('[onCreateProduct] downloadMedia error:', e);
                        }
                    }
                    setVendorIngestImage(imageToUse);
                    setVendorIngestMsg(text);
                }}
                onAutoBarcodeTag={() => handleAutoBarcodeTag(actionMenu.message!)}
                onQuoteReply={() => setReplyText(`> ${actionMenu.message?.caption || actionMenu.message?.body || ''}\n\n`)}
            />

            {/* Vendor Ingestion Modals (spec §8.2) */}
            {vendorIngestMsg !== null && (
                <VendorIngestionModal
                    isOpen
                    onClose={() => {
                        setVendorIngestMsg(null);
                        setVendorIngestImage(null);
                        setIngestSourceContext(null);
                    }}
                    messageBody={vendorIngestMsg}
                    vendorId={contactVendor?.id}
                    vendorName={contactVendor?.name}
                    imageUrl={vendorIngestImage || undefined}
                    sourceContext={ingestSourceContext || undefined}
                />
            )}
            {addInventoryMsg !== null && (
                <AddExistingInventoryModal
                    isOpen
                    onClose={() => {
                        setAddInventoryMsg(null);
                        setIngestSourceContext(null);
                    }}
                    messageBody={addInventoryMsg}
                    vendorId={contactVendor?.id}
                    vendorName={contactVendor?.name}
                    sourceContext={ingestSourceContext || undefined}
                />
            )}

            {/* Smart Broadcast Campaign Composer (spec §11) */}
            <BroadcastComposerModal
                isOpen={showBroadcastModal}
                onClose={() => setShowBroadcastModal(false)}
            />

            {/* Multi-Product Catalog Broadcaster (Groups, Communities, Channels & Status) */}
            <ProductBroadcastModal
                isOpen={showProductBroadcastModal}
                onClose={() => setShowProductBroadcastModal(false)}
            />

            {/* Timed Flash Drops Modal (Option B: WhatsApp Commerce 2.0) */}
            <FlashDropModal
                isOpen={showFlashDropModal}
                onClose={() => setShowFlashDropModal(false)}
            />

            {/* Razorpay Payment Link Modal */}
            <RazorpayPaymentModal
                isOpen={showRazorpayModal}
                onClose={() => {
                    setShowRazorpayModal(false);
                    setRazorpayModalOrderId('');
                }}
                customerName={customer?.name || ''}
                customerPhone={customer?.phone || (selectedChat ? phoneFromChatId(selectedChat) || '' : '')}
                customerId={customer?.id}
                defaultAmount={razorpayModalAmount}
                defaultOrderId={razorpayModalOrderId}
                onSendPaymentLinkToChat={handleSendPaymentLinkToChat}
            />

            {/* WhatsApp Catalog Sync Modal */}
            <WhatsAppCatalogSyncModal
                isOpen={showCatalogSyncModal}
                onClose={() => setShowCatalogSyncModal(false)}
            />

            {/* Dedicated WhatsApp Catalog Editor & Live Inventory Sync Window */}
            <WhatsAppCatalogEditorModal
                isOpen={showCatalogEditorModal}
                onClose={() => setShowCatalogEditorModal(false)}
            />

            {/* WhatsApp Admin Account Binding & Approval Modal */}
            <AdminApprovalModal
                isOpen={approvalModalOpen}
                onClose={() => setApprovalModalOpen(false)}
                mode={approvalModalMode}
                actionType={pendingActionType}
                binding={binding}
                connectedPhone={connectedDeviceNumber ? (connectedDeviceNumber.startsWith('+') ? connectedDeviceNumber : `+${connectedDeviceNumber}`) : (phoneNumber ? `+${phoneNumber}` : undefined)}
                onApprovalSuccess={handleApprovalSuccess}
                onBindingUpdated={(newBinding) => setBinding(newBinding)}
            />
        </div>
    );
}
